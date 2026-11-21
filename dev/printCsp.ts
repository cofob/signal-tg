// Prints the app's Content-Security-Policy, for a deployment that sends it as a response header
import buildCsp from '../plugins/csp.ts';

process.stdout.write(`${buildCsp(process.env.APP_ENV || 'production', process.env.SIGNAL_TUNNEL_URL)}\n`);
