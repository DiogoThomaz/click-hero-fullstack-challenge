import { Router } from "express";
import { violationSchema } from "../../../core/entities/violation.entity.js";
import type { TakedownJobQueueRepository } from "../../../core/repositories/takedown-job-queue.repository.js";
import { EnqueueTakedownUseCase } from "../../../core/usecases/enqueue-takedown.usecase.js";

export function createWebhookRouter(queue: TakedownJobQueueRepository) {
  const router = Router();

  router.post("/violation", async (req, res, next) => {
    try {
      const parsed = violationSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid payload",
          details: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const { adId, tenantId } = parsed.data;

      const useCase = new EnqueueTakedownUseCase(queue);
      const jobId = await useCase.execute({ adId, tenantId });

      res.status(202).json({ jobId });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
