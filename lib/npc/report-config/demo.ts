import type {DailyBrief,WeeklyReport} from '../molly-reports';
import daily from './daily-demo.json';
import weekly from './weekly-demo.json';
export function createDailyBriefDemo():DailyBrief{return structuredClone(daily) as DailyBrief;}
export function createWeeklyReportDemo():WeeklyReport{return structuredClone(weekly) as WeeklyReport;}
