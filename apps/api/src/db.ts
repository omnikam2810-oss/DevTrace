import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function ensureDefaultProject() {
  const organization = await prisma.organization.upsert({
    where: { slug: "default" },
    update: {},
    create: {
      name: "Default Organization",
      slug: "default"
    }
  });

  return prisma.project.upsert({
    where: {
      organizationId_slug: {
        organizationId: organization.id,
        slug: "default"
      }
    },
    update: {},
    create: {
      organizationId: organization.id,
      name: "Default Project",
      slug: "default",
      description: "Local development project"
    }
  });
}
