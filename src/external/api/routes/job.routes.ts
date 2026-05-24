import { Router } from "express";
import type { TakedownJobQueueRepository } from "../../../core/repositories/takedown-job-queue.repository.js";
import { GetJobStatusUseCase } from "../../../core/usecases/get-job-status.usecase.js";

export function createJobRouter(queue: TakedownJobQueueRepository) {
  const router = Router();

  router.get("/:id", async (req, res, next) => {
    try {
      const { id } = req.params;

      const useCase = new GetJobStatusUseCase(queue);
      const status = await useCase.execute(id);

      if (!status) {
        res.status(404).json({ error: "Job not found" });
        return;
      }

      res.json(status);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
