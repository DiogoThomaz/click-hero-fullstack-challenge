export interface HealthCheckService {
  isHealthy(): Promise<boolean>;
}
