export type HealthInputs = {
  latencyMs?: number;
  errorRate?: number;
  cpuPercent?: number;
  memoryPercent?: number;
  diskPercent?: number;
  lastSeenAgeSec?: number;
};

export function calculateHealthScore(input: HealthInputs) {
  let score = 100;

  score -= penalty(input.latencyMs, [
    [250, 5],
    [500, 12],
    [1000, 25],
    [2000, 40]
  ]);
  score -= penalty(input.errorRate, [
    [0.01, 5],
    [0.03, 15],
    [0.05, 30],
    [0.1, 50]
  ]);
  score -= penalty(input.cpuPercent, [
    [70, 8],
    [85, 18],
    [95, 35]
  ]);
  score -= penalty(input.memoryPercent, [
    [70, 8],
    [85, 18],
    [95, 35]
  ]);
  score -= penalty(input.diskPercent, [
    [80, 8],
    [90, 20],
    [97, 40]
  ]);
  score -= penalty(input.lastSeenAgeSec, [
    [60, 10],
    [180, 25],
    [600, 60]
  ]);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function penalty(value: number | undefined, thresholds: Array<[number, number]>) {
  if (value === undefined) {
    return 0;
  }

  return thresholds.reduce((current, [threshold, cost]) => {
    return value >= threshold ? cost : current;
  }, 0);
}

