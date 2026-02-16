import type { FastifyBaseLogger } from 'fastify';

interface PostgrestInstanceHealth {
  url: string;
  isHealthy: boolean;
  lastCheck: number;
  lastError?: string;
}

interface PostgrestManagerOptions {
  healthCheckIntervalMs: number;
  healthCheckTimeoutMs: number;
  logger: FastifyBaseLogger;
}

export class PostgrestManager {
  private instances = new Map<string, PostgrestInstanceHealth>();
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(private options: PostgrestManagerOptions) {
    this.startHealthCheckLoop();
  }

  /**
   * Register or update a PostgREST instance for a project.
   * Performs an immediate health check.
   */
  async registerInstance(projectRef: string, url: string): Promise<boolean> {
    const isHealthy = await this.checkHealth(url);

    this.instances.set(projectRef, {
      url,
      isHealthy,
      lastCheck: Date.now(),
      lastError: isHealthy ? undefined : 'Initial health check failed',
    });

    if (isHealthy) {
      this.options.logger.info({ project: projectRef, url }, 'PostgREST instance registered');
    } else {
      this.options.logger.warn({ project: projectRef, url }, 'PostgREST instance registered but not healthy');
    }

    return isHealthy;
  }

  /**
   * Unregister a PostgREST instance (e.g., when project is deleted).
   */
  unregisterInstance(projectRef: string): void {
    this.instances.delete(projectRef);
    this.options.logger.info({ project: projectRef }, 'PostgREST instance unregistered');
  }

  /**
   * Get the URL for a project's PostgREST instance.
   */
  getUrl(projectRef: string): string | undefined {
    return this.instances.get(projectRef)?.url;
  }

  /**
   * Check if a PostgREST instance is healthy.
   */
  isHealthy(projectRef: string): boolean {
    return this.instances.get(projectRef)?.isHealthy ?? false;
  }

  /**
   * Get health status for a project.
   */
  getHealth(projectRef: string): PostgrestInstanceHealth | undefined {
    return this.instances.get(projectRef);
  }

  /**
   * Perform a health check on a PostgREST URL.
   * Returns true if the instance responds to GET / with 200.
   */
  private async checkHealth(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(this.options.healthCheckTimeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Manually trigger a health check for a specific project.
   */
  async refreshHealth(projectRef: string): Promise<boolean> {
    const instance = this.instances.get(projectRef);
    if (!instance) return false;

    const isHealthy = await this.checkHealth(instance.url);
    instance.isHealthy = isHealthy;
    instance.lastCheck = Date.now();

    if (!isHealthy) {
      instance.lastError = 'Health check failed';
      this.options.logger.warn({ project: projectRef, url: instance.url }, 'PostgREST instance unhealthy');
    }

    return isHealthy;
  }

  /**
   * Start the background health check loop.
   */
  private startHealthCheckLoop(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks().catch((err) => {
        this.options.logger.error({ err }, 'Health check loop error');
      });
    }, this.options.healthCheckIntervalMs);
  }

  /**
   * Perform health checks on all registered instances.
   */
  private async performHealthChecks(): Promise<void> {
    const checks = Array.from(this.instances.entries()).map(async ([ref, instance]) => {
      const isHealthy = await this.checkHealth(instance.url);

      if (isHealthy !== instance.isHealthy) {
        // Health status changed
        if (isHealthy) {
          this.options.logger.info({ project: ref, url: instance.url }, 'PostgREST instance recovered');
        } else {
          this.options.logger.warn({ project: ref, url: instance.url }, 'PostgREST instance became unhealthy');
        }
      }

      instance.isHealthy = isHealthy;
      instance.lastCheck = Date.now();
      instance.lastError = isHealthy ? undefined : 'Health check failed';
    });

    await Promise.allSettled(checks);
  }

  /**
   * Shutdown the manager (stop health checks).
   */
  shutdown(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this.instances.clear();
    this.options.logger.info('PostgREST manager shut down');
  }
}
