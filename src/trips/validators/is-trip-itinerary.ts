function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

/** Find the budget range object regardless of what currency suffix the LLM used */
function findBudgetField(day: Record<string, unknown>): unknown {
  if (isObject(day.estimatedBudget)) return day.estimatedBudget;
  if (isObject(day.estimatedBudgetEur)) return day.estimatedBudgetEur;
  const entry = Object.entries(day).find(
    ([k]) => k.toLowerCase().startsWith('estimatedbudget'),
  );
  return entry ? entry[1] : undefined;
}

/** Find the overall budget object regardless of currency suffix */
function findOverallBudgetField(
  value: Record<string, unknown>,
): unknown {
  if (isObject(value.overallBudgetEstimate)) return value.overallBudgetEstimate;
  if (isObject(value.overallBudgetEstimateEur)) return value.overallBudgetEstimateEur;
  const entry = Object.entries(value).find(
    ([k]) => k.toLowerCase().startsWith('overallbudgetestimate'),
  );
  return entry ? entry[1] : undefined;
}

export function isTripItinerary(value: unknown): boolean {
  if (!isObject(value)) {
    return false;
  }

  const overview = value.tripOverview;
  const days = value.dailyItinerary;
  const overallBudget = findOverallBudgetField(value);
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
      if (!isObject(day)) return false;
      const budget = findBudgetField(day);
      if (!isObject(budget)) return false;

      return (
        typeof day.day === 'number' &&
        typeof day.date === 'string' &&
        typeof day.focus === 'string' &&
        isStringArray(day.morning) &&
        isStringArray(day.afternoon) &&
        isStringArray(day.evening) &&
        typeof budget.low === 'number' &&
        typeof budget.high === 'number' &&
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
