import { BadRequestException, HttpException, InternalServerErrorException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { AllExceptionsFilter } from './allExceptions.filter';

jest.mock('@sentry/nestjs', () => ({
    captureException: jest.fn(),
}));

describe('AllExceptionsFilter', () => {
    let filter: AllExceptionsFilter;
    const captureException = Sentry.captureException as jest.Mock;

    beforeEach(() => {
        filter = new AllExceptionsFilter();
        captureException.mockClear();
        // Silence the logger.error noise in test output.
        jest.spyOn((filter as any).logger, 'error').mockImplementation(() => undefined);
    });

    /** Build a fake HTTP ArgumentsHost that records the JSON response. */
    function httpHost() {
        const json = jest.fn();
        const status = jest.fn(() => ({ json }));
        const host: any = {
            getType: () => 'http',
            switchToHttp: () => ({
                getResponse: () => ({ status }),
                getRequest: () => ({ url: '/x' }),
            }),
        };
        return { host, status, json };
    }

    it('captures a non-HttpException (unexpected crash)', () => {
        const { host } = httpHost();
        filter.catch(new Error('boom'), host);
        expect(captureException).toHaveBeenCalledTimes(1);
    });

    it('captures a 5xx HttpException', () => {
        const { host } = httpHost();
        filter.catch(new InternalServerErrorException('nope'), host);
        expect(captureException).toHaveBeenCalledTimes(1);
    });

    it('does NOT capture a 4xx HttpException', () => {
        const { host } = httpHost();
        filter.catch(new BadRequestException('bad input'), host);
        expect(captureException).not.toHaveBeenCalled();
    });

    it('does NOT capture an arbitrary 4xx HttpException', () => {
        const { host } = httpHost();
        filter.catch(new HttpException('teapot', 418), host);
        expect(captureException).not.toHaveBeenCalled();
    });

    it('still writes the REST envelope with the status code', () => {
        const { host, status, json } = httpHost();
        filter.catch(new BadRequestException('bad input'), host);
        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith(
            expect.objectContaining({ statusCode: 400, path: '/x' }),
        );
    });

    it('rethrows for graphql context (does not write a REST response)', () => {
        const host: any = { getType: () => 'graphql' };
        const err = new BadRequestException('gql');
        expect(() => filter.catch(err, host)).toThrow(err);
    });
});
