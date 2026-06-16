import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { prisma } from "../db.js";

type IngestAuthOptions = {
  agentSecret?: string;
};

const DEV_PLACEHOLDER_SECRET = "replace-with-ingest-secret";

export function createIngestAuth({ agentSecret }: IngestAuthOptions): RequestHandler {
  return async (req, res, next) => {
    try {
      const presentedKey = readIngestKey(req);

      if (!presentedKey) {
        res.status(401).json({ error: "Missing ingest API key" });
        return;
      }

      if (agentSecret && constantTimeEqual(presentedKey, agentSecret)) {
        return next();
      }

      const keyHash = hashApiKey(presentedKey);
      const apiKey = await prisma.apiKey.findFirst({
        where: {
          AND: [
            {
              OR: [
                { keyHash },
                { keyHash: `sha256:${keyHash}` }
              ]
            },
            {
              OR: [
                { expiresAt: null },
                { expiresAt: { gt: new Date() } }
              ]
            }
          ],
          revokedAt: null
        },
        select: {
          id: true,
          scopes: true
        }
      });

      if (!apiKey || !hasIngestScope(apiKey.scopes)) {
        res.status(401).json({ error: "Invalid ingest API key" });
        return;
      }

      await prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() }
      });

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function hashApiKey(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function shouldWarnAboutDefaultIngestSecret(agentSecret: string | undefined) {
  return agentSecret === DEV_PLACEHOLDER_SECRET;
}

function readIngestKey(req: Request) {
  const devTraceKey = req.header("X-DevTrace-Key");
  if (devTraceKey) {
    return devTraceKey.trim();
  }

  const authorization = req.header("Authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return undefined;
}

function hasIngestScope(scopes: string[]) {
  return scopes.includes("ingest") || scopes.includes("telemetry:write") || scopes.includes("*");
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
