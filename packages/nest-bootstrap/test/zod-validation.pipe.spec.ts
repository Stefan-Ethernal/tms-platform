import { ZodValidationPipe } from '../src/http';

describe('ZodValidationPipe without a schema', () => {
  const pipe = new ZodValidationPipe();
  it.each(['body', 'query', 'param'] as const)(
    'refuses a %s whose type carries no zod schema',
    (type) => {
      expect(() => pipe.transform({ a: 1 }, { type, metatype: Object, data: undefined })).toThrow(
        /no zod DTO schema/,
      );
    },
  );
  it('ignores custom parameter decorators', () => {
    expect(pipe.transform('x', { type: 'custom', metatype: String, data: undefined })).toBe('x');
  });
});
