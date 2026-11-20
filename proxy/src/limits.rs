//! Global and per-client limits: concurrent tunnels, new-tunnel rate, bandwidth, hourly bytes, and
//! temporary bans after repeated violations. Clients are keyed by IPv4 address or IPv6 /64.

use std::{
    collections::HashMap,
    net::{IpAddr, Ipv6Addr},
    sync::{Arc, Mutex, MutexGuard, PoisonError},
    time::Duration,
};

use tokio::time::Instant;

const MINUTE: Duration = Duration::from_secs(60);
const HOUR: Duration = Duration::from_secs(3600);
/// A host usually gets a whole IPv6 /64
const IPV6_CLIENT_PREFIX_BITS: u32 = 64;

#[derive(Clone)]
pub struct LimitConfig {
    pub max_tunnels: usize,
    pub max_tunnels_per_ip: usize,
    pub new_tunnels_per_ip_per_minute: u32,
    /// Bytes per second in each direction
    pub bandwidth_per_ip: u64,
    pub bandwidth_burst_per_ip: u64,
    /// Bytes per hour in both directions together
    pub hourly_bytes_per_ip: Option<u64>,
    /// `None` disables bans
    pub ban_after_violations: Option<u32>,
    pub ban_window: Duration,
    pub ban_duration: Duration,
    pub max_tracked_ips: usize,
}

pub struct Limits {
    config: LimitConfig,
    tunnel_cost: Duration,
    bandwidth_burst: Duration,
    violation_cost: Duration,
    /// A ban starts once the violation budget's lead exceeds that of `ban_after_violations - 1`
    /// violations at once, so `ban_after_violations` violations within the window start one
    ban_threshold: Duration,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    open: usize,
    clients: HashMap<IpAddr, Client>,
}

struct Client {
    open: usize,
    new_tunnels: Budget,
    upload: Budget,
    download: Budget,
    hourly_bytes: Budget,
    violations: Budget,
    banned_until: Option<Instant>,
}

#[derive(Clone, Copy)]
pub enum Refusal {
    Banned(Duration),
    TooManyTunnels,
    TooManyClients,
    TooManyClientTunnels,
    TunnelRate(Duration),
    HourlyBytes(Duration),
}

/// The client used up its hourly bytes
pub struct HourlyBytesExceeded;

#[derive(Clone, Copy)]
pub enum Direction {
    Upload,
    Download,
}

/// Generic cell rate algorithm state: each event adds its cost to `refill_at`, and the budget is
/// full again once `refill_at` has passed. A burst may run up to `burst` ahead of the current time.
#[derive(Clone, Copy)]
struct Budget {
    refill_at: Instant,
}

impl Limits {
    pub fn new(config: LimitConfig) -> Arc<Self> {
        let tunnel_cost = MINUTE / config.new_tunnels_per_ip_per_minute;
        let bandwidth_burst = get_byte_cost(
            config.bandwidth_burst_per_ip,
            config.bandwidth_per_ip,
            Duration::from_secs(1),
        );
        let violation_cost = config
            .ban_after_violations
            .map_or(Duration::ZERO, |count| config.ban_window / count);
        let ban_threshold = config
            .ban_after_violations
            .map_or(Duration::ZERO, |count| violation_cost * (count - 1));
        Arc::new(Self {
            config,
            tunnel_cost,
            bandwidth_burst,
            violation_cost,
            ban_threshold,
            state: Mutex::default(),
        })
    }

    /// Returns the remaining ban time
    pub fn check_ban(&self, ip: IpAddr) -> Result<(), Duration> {
        let now = Instant::now();
        let state = self.lock();
        match state
            .clients
            .get(&get_client_key(ip))
            .and_then(|client| client.banned_until)
        {
            Some(until) if until > now => Err(until - now),
            _ => Ok(()),
        }
    }

    /// Records a violation and returns `true` if it starts a ban
    pub fn record_violation(&self, ip: IpAddr) -> bool {
        if self.config.ban_after_violations.is_none() {
            return false;
        }
        let now = Instant::now();
        let mut state = self.lock();
        let Some(client) = self.get_client(&mut state, get_client_key(ip), now) else {
            return false;
        };
        if client.banned_until.is_some_and(|until| until > now) {
            return false;
        }
        client.violations.charge(now, self.violation_cost);
        if client.violations.get_lead(now) <= self.ban_threshold {
            return false;
        }
        client.banned_until = Some(now + self.config.ban_duration);
        client.violations = Budget { refill_at: now };
        true
    }

    pub fn acquire(self: &Arc<Self>, ip: IpAddr) -> Result<TunnelSlot, Refusal> {
        let key = get_client_key(ip);
        let now = Instant::now();
        let mut state = self.lock();
        if state.open >= self.config.max_tunnels {
            return Err(Refusal::TooManyTunnels);
        }
        let client = self
            .get_client(&mut state, key, now)
            .ok_or(Refusal::TooManyClients)?;
        if let Some(until) = client.banned_until.filter(|until| *until > now) {
            return Err(Refusal::Banned(until - now));
        }
        if client.open >= self.config.max_tunnels_per_ip {
            return Err(Refusal::TooManyClientTunnels);
        }
        if self.config.hourly_bytes_per_ip.is_some() && client.hourly_bytes.get_lead(now) > HOUR {
            return Err(Refusal::HourlyBytes(
                client.hourly_bytes.get_lead(now).saturating_sub(HOUR),
            ));
        }
        let wait = client.new_tunnels.get_wait(now, self.tunnel_cost, MINUTE);
        if !wait.is_zero() {
            return Err(Refusal::TunnelRate(wait));
        }
        client.new_tunnels.charge(now, self.tunnel_cost);
        client.open += 1;
        state.open += 1;
        Ok(TunnelSlot {
            limits: Arc::clone(self),
            key,
        })
    }

    pub fn get_open_count(&self) -> usize {
        self.lock().open
    }

    /// Forgets clients whose state equals that of a new client
    pub fn prune(&self) {
        let now = Instant::now();
        self.lock().clients.retain(|_, client| !client.is_idle(now));
    }

    /// Returns the client's entry, adding one unless the table is full
    fn get_client<'a>(
        &self,
        state: &'a mut State,
        key: IpAddr,
        now: Instant,
    ) -> Option<&'a mut Client> {
        if !state.clients.contains_key(&key) && state.clients.len() >= self.config.max_tracked_ips {
            state.clients.retain(|_, client| !client.is_idle(now));
            if state.clients.len() >= self.config.max_tracked_ips {
                return None;
            }
        }
        Some(state.clients.entry(key).or_insert_with(|| Client::new(now)))
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// An open tunnel's share of the global and per-client counts, released on drop
pub struct TunnelSlot {
    limits: Arc<Limits>,
    key: IpAddr,
}

impl TunnelSlot {
    /// Charges transferred bytes and returns how long to pause reading in this direction
    pub fn charge(
        &self,
        direction: Direction,
        bytes: usize,
    ) -> Result<Duration, HourlyBytesExceeded> {
        let limits = &self.limits;
        let config = &limits.config;
        let now = Instant::now();
        let mut state = limits.lock();
        let Some(client) = state.clients.get_mut(&self.key) else {
            return Ok(Duration::ZERO);
        };
        let bytes = u64::try_from(bytes).unwrap_or(u64::MAX);
        if let Some(hourly_bytes) = config.hourly_bytes_per_ip {
            client
                .hourly_bytes
                .charge(now, get_byte_cost(bytes, hourly_bytes, HOUR));
            if client.hourly_bytes.get_lead(now) > HOUR {
                return Err(HourlyBytesExceeded);
            }
        }
        let budget = match direction {
            Direction::Upload => &mut client.upload,
            Direction::Download => &mut client.download,
        };
        budget.charge(
            now,
            get_byte_cost(bytes, config.bandwidth_per_ip, Duration::from_secs(1)),
        );
        Ok(budget.get_lead(now).saturating_sub(limits.bandwidth_burst))
    }

    pub fn record_violation(&self) -> bool {
        self.limits.record_violation(self.key)
    }
}

impl Drop for TunnelSlot {
    fn drop(&mut self) {
        let mut state = self.limits.lock();
        state.open = state.open.saturating_sub(1);
        if let Some(client) = state.clients.get_mut(&self.key) {
            client.open = client.open.saturating_sub(1);
        }
    }
}

impl Client {
    fn new(now: Instant) -> Self {
        let budget = Budget { refill_at: now };
        Self {
            open: 0,
            new_tunnels: budget,
            upload: budget,
            download: budget,
            hourly_bytes: budget,
            violations: budget,
            banned_until: None,
        }
    }

    fn is_idle(&self, now: Instant) -> bool {
        self.open == 0
            && self.banned_until.is_none_or(|until| until <= now)
            && [
                self.new_tunnels,
                self.upload,
                self.download,
                self.hourly_bytes,
                self.violations,
            ]
            .iter()
            .all(|budget| budget.refill_at <= now)
    }
}

impl Budget {
    fn charge(&mut self, now: Instant, cost: Duration) {
        self.refill_at = self.refill_at.max(now) + cost;
    }

    /// How far the budget's use runs ahead of `now`
    fn get_lead(self, now: Instant) -> Duration {
        self.refill_at.saturating_duration_since(now)
    }

    /// How long to wait before an event of `cost` fits in `burst`
    fn get_wait(self, now: Instant, cost: Duration, burst: Duration) -> Duration {
        (self.get_lead(now) + cost).saturating_sub(burst)
    }
}

/// Time that `bytes` take at `rate` bytes per `period`
fn get_byte_cost(bytes: u64, rate: u64, period: Duration) -> Duration {
    let nanos = u128::from(bytes) * period.as_nanos() / u128::from(rate);
    Duration::from_nanos(u64::try_from(nanos).unwrap_or(u64::MAX))
}

fn get_client_key(ip: IpAddr) -> IpAddr {
    match ip.to_canonical() {
        IpAddr::V6(ip) => {
            let mask = u128::MAX
                .checked_shl(128 - IPV6_CLIENT_PREFIX_BITS)
                .unwrap_or(0);
            IpAddr::V6(Ipv6Addr::from_bits(ip.to_bits() & mask))
        }
        ip @ IpAddr::V4(_) => ip,
    }
}
