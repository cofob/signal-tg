// 2024-01-01 is a Monday, so that day 1 is Monday and day 7 is Sunday
const MONDAY = new Date(2024, 0, 1);

/** The short name of a day of the week in the language, where 1 is Monday and 7 is Sunday */
export function getWeekdayName(langCode: string, day: number) {
  const date = new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate() + day - 1);
  return new Intl.DateTimeFormat(langCode, { weekday: 'short' }).format(date);
}
