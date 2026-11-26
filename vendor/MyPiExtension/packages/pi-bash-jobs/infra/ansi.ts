/**
 * ANSI escape stripping for the job log tee (doc 37 §1.3 的落盘口径).
 *
 * The ring keeps raw bytes — the model's inspect output and snapshot tails behave exactly as
 * before. Only the tee strips escape sequences, so a curl/pip progress bar lands in the log as
 * whole text lines instead of cursor-movement noise PiDesk's tail would render literally.
 *
 * One combined pattern, one pass per line — the tee runs this on every committed line, so the
 * old three-sequential-replace form (three full scans) showed up in profiles of chatty jobs.
 * Alternation order matters: CSI/OSC must be tried before the bare-control class, and their
 * second byte (`[` or `]`) can never start the other alternative's match.
 */

// CSI: ESC [ <params 0-9:;<=>?> <intermediates " -/"> <final @-~>
// OSC: ESC ] ... terminated by BEL or ST (ESC \)
// Leftover C0 controls other than \n and \t (BEL, NUL, backspace, a lone ESC…). \r never reaches
// a tee: the ring commits on \r too, so lines are already split.
const STRIP_PATTERN =
	/\x1b\[[0-9:;<=>?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

export function stripAnsi(line: string): string {
	return line.replace(STRIP_PATTERN, "");
}
