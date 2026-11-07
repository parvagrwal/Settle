// Status labels — the status is always a word, never colour alone.
// Colour adds meaning, the word carries it, so the grid reads the same
// for a reader who cannot see colour.
export function statusLabel(status: string): string {
  switch (status) {
    case "paid":
      return "Paid";
    case "waiting":
      return "Waiting";
    case "waiting_for_meera":
      return "Waiting for owner";
    case "blocked":
      return "Blocked";
    case "unclaimed":
      return "Unclaimed";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}
