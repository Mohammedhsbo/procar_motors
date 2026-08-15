import { JsonLogger } from './json.logger';

describe('JsonLogger', () => {
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  beforeEach(() => {
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
  });

  it('writes a single JSON object per info log', () => {
    const logger = new JsonLogger();
    logger.log('boot', 'Bootstrap');
    expect(stdout).toHaveBeenCalled();
    const firstCall = stdout.mock.calls[0] as unknown as [string];
    const line = String(firstCall[0]).trim();
    const parsed = JSON.parse(line) as {
      level: string;
      message: string;
      context: string;
      ts: string;
    };
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('boot');
    expect(parsed.context).toBe('Bootstrap');
    expect(parsed.ts).toMatch(/^\d{4}-/);
  });

  it('writes errors to stderr as JSON', () => {
    const logger = new JsonLogger();
    logger.error('fail', 'stack', 'Http');
    const firstCall = stderr.mock.calls[0] as unknown as [string];
    const line = String(firstCall[0]).trim();
    const parsed = JSON.parse(line) as {
      level: string;
      message: string;
      stack: string;
    };
    expect(parsed.level).toBe('error');
    expect(parsed.message).toBe('fail');
    expect(parsed.stack).toBe('stack');
  });
});
