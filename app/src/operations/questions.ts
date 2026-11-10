// The questions the investigator answers. The same list drives the quick
// questions next to the grid and the prompt starters in the Studio AI Assistant.
// Wording matches SUPPORTED_QUESTIONS in src/server/operationsInvestigation.ts.
export const SUPPORTED_QUESTIONS: ReadonlyArray<{ label: string; question: string }> = [
  { label: "Needs attention", question: "Which payments need attention?" },
  { label: "Approaching deadlines", question: "Which payments are approaching deadlines?" },
  { label: "Unreconciled", question: "Which payments remain unreconciled?" },
  { label: "Awaiting approval", question: "Which payments are awaiting approval?" },
  { label: "Outside budget", question: "Which payments cannot be paid within the current budget?" },
  { label: "Incomplete evidence", question: "Which payments have incomplete provider evidence?" },
];
