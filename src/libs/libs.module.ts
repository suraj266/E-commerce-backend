import { Module, OnModuleInit } from "@nestjs/common";
import { Graphql } from "./graphql.module";
import { PinoLoggerModule } from "./pinoLogger.module";

@Module({
    imports: [
        Graphql,
        PinoLoggerModule,
    ]
})
export class LibsModule implements OnModuleInit {
    onModuleInit() {
        console.log("LibsModule initialized ✅");
    }
}