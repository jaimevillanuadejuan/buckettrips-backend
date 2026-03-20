function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

export function isTripItinerary(value: unknown): boolean {
  if (!isObject(value)) {
    return false;
  }

  const overview = value.tripOverview;
  const days = value.dailyItinerary;
  const overallBudget = value.overallBudgetEstimateEur;
  const followUps = value.followUpQuestions;

  if (
    !isObject(overview) ||
    !isObject(overallBudget) ||
    !Array.isArray(days) ||
    !Array.isArray(followUps)
  ) {
    return false;
  }

  if (
    typeof overview.destination !== 'string' ||
    typeof overview.travelWindow !== 'string' ||
    typeof overview.planningStyle !== 'string' ||
    !isStringArray(overview.keyAssumptions)
  ) {
    return false;
  }

  if (
    typeof overallBudget.low !== 'number' ||
    typeof overallBudget.high !== 'number' ||
    !isStringArray(overallBudget.notes)
  ) {
    return false;
  }

  return (
    days.every((day) => {
      if (!isObject(day) || !isObject(day.estimatedBudgetEur)) {
        return false;
      }

      return (
        typeof day.day === 'number' &&
        typeof day.date === 'string' &&
        typeof day.focus === 'string' &&
        isStringArray(day.morning) &&
        isStringArray(day.afternoon) &&
        isStringArray(day.evening) &&
        typeof day.estimatedBudgetEur.low === 'number' &&
        typeof day.estimatedBudgetEur.high === 'number' &&
        isStringArray(day.budgetTips) &&
        isStringArray(day.logisticsNotes) &&
        isStringArray(day.reservationAlerts)
      );
    }) &&
    followUps.every(
      (question) =>
        isObject(question) &&
        typeof question.question === 'string' &&
        typeof question.whyItMatters === 'string',
    )
  );
}
