import { Router } from "express";
import type { TakedownJobQueueRepository } from "../../../core/repositories/takedown-job-queue.repository.js";
import { GetHealthUseCase } from "../../../core/usecases/get-health.usecase.js";

export function createHealthRouter(queue: TakedownJobQueueRepository) {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    try {
      const useCase = new GetHealthUseCase(queue);
      const health = await useCase.execute();

      res.status(health.status === "ok" ? 200 : 503).json(health);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
