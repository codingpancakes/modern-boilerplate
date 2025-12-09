import { readFileSync } from "fs";
import { join } from "path";

// Load all GraphQL schema files
const loadSchema = (filename: string): string => {
	return readFileSync(join(__dirname, filename), "utf-8");
};

// Combine all schema files
export const typeDefs = `
  ${loadSchema("base.graphql")}
  ${loadSchema("scalars.graphql")}
  ${loadSchema("users.graphql")}
  ${loadSchema("organizations.graphql")}
  ${loadSchema("media.graphql")}
`;
