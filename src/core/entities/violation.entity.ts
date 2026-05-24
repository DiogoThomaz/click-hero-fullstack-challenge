import { z } from "zod";

export const ViolationType = z.enum(["PROHIBITED_TERM", "BRAND_VIOLATION", "COMPLIANCE_FAIL"]);
export type ViolationType = z.infer<typeof ViolationType>;

export const Severity = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type Severity = z.infer<typeof Severity>;

export const violationSchema = z.object({
  adId: z.string().min(1, "adId is required"),
  tenantId: z.string().min(1, "tenantId is required"),
  violationType: ViolationType,
  severity: Severity,
  detectedAt: z.string().datetime({ message: "detectedAt must be a valid ISO 8601 datetime" }),
});

export type ViolationPayload = z.infer<typeof violationSchema>;
