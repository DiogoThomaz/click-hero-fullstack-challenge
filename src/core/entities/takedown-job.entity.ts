import { z } from "zod";

export const takedownJobDataSchema = z.object({
  adId: z.string().min(1),
  tenantId: z.string().min(1),
});

export type TakedownJobData = z.infer<typeof takedownJobDataSchema>;

export const jobStatusSchema = z.object({
  jobId: z.string().min(1),
  status: z.string().min(1),
  attempts: z.number().int().nonnegative(),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
});

export type JobStatus = z.infer<typeof jobStatusSchema>;
