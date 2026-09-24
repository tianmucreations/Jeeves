// An error whose message is already in the person's plain English: shown on
// screen exactly as thrown. Thrown by the tools themselves for conditions they
// have already worded (a folder that does not exist, a refused program) so the
// transcript never upgrades a clear sentence into "something unexpected went
// wrong" (seen on the owner's Desktop, 24 Sept).
export class PlainError extends Error {}
