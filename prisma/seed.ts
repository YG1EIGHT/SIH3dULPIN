import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const passwordHash = await bcrypt.hash("Surveyor@123", 12);

  const surveyor = await prisma.user.upsert({
    where: {
      email: "surveyor@ulpin.gov",
    },

    update: {
      name: "Government Surveyor",
      passwordHash,
      role: "SURVEYOR",
    },

    create: {
      name: "Government Surveyor",
      email: "surveyor@ulpin.gov",
      passwordHash,
      role: "SURVEYOR",
    },
  });

  console.log("Surveyor account created/updated:");
  console.log(`Email: ${surveyor.email}`);
  console.log(`Role: ${surveyor.role}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });