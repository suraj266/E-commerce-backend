import { Logger, Module, OnModuleInit } from "@nestjs/common";
import { Graphql } from "./graphql.module";
import { PinoLoggerModule } from "./pinoLogger.module";

@Module({
    imports: [
        Graphql,
        PinoLoggerModule,
    ]
})
export class LibsModule implements OnModuleInit {
    private readonly logger = new Logger(LibsModule.name);
    onModuleInit() {
        this.logger.log("LibsModule initialized ✅");
    }
}
