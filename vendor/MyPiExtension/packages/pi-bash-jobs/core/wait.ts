/**
 * One slice of waiting that also stops the moment a job settles. Shared by the blocking bash
 * loop and by the inspect tool's long poll so both wake at the same granularity.
 */

import type { Job } from "./jobs.ts";

export type WaitSlice = (ms: number, job: Job) => Promise<void>;

export const settleAwareWait: WaitSlice = (ms, job) =>
	new Promise<void>((resolve) => {
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(finish, ms);
		void job.exited.then(finish);
	});
