import { config } from "@/common/config/config";
import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";

const transport = config.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: {
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: 'SYS:dd-mm-yyyy HH:MM:ss',
        singleLine: true,
    },
} : undefined;

@Module({
    imports: [
        LoggerModule.forRoot({
            pinoHttp: {
                transport
            },
        }),
    ],
})
export class PinoLoggerModule { }