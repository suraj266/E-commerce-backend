import { Module } from "@nestjs/common";
import { GraphQLModule } from "@nestjs/graphql";
import { ApolloDriver, ApolloDriverConfig } from "@nestjs/apollo";
import { join } from "path";

@Module({
    imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
            driver: ApolloDriver,
            autoSchemaFile: join(process.cwd(), 'src/graphql_schema/schema.gql'),
            graphiql: true,
            sortSchema: true,
            context: ({ req, res }) => ({ req, res }),
        }),
    ],
})
export class Graphql { }