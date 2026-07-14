import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const depthLimit = require('graphql-depth-limit');

// In production the schema explorer and introspection are disabled so the
// public endpoint doesn't hand attackers the full admin schema. A depth limit
// caps deeply-nested queries (a cheap DoS vector); 12 is generous — the deepest
// real operation (order → sellerOrders → items → attributes) is ~5 levels.
const isProd = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/graphql_schema/schema.gql'),
      graphiql: !isProd,
      introspection: !isProd,
      sortSchema: true,
      validationRules: [depthLimit(12)],
      context: ({ req, res }) => ({ req, res }),
    }),
  ],
})
export class Graphql {}
