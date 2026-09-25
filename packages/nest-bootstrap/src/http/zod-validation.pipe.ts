import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { DomainError } from '@tms/contracts';
import type { z } from 'zod';

export interface ZodDtoClass<S extends z.ZodType = z.ZodType> {
  new (): z.infer<S>;
  readonly schema: S;
  readonly isZodDto: true;
}

/** `class LoginDto extends zodDto(LoginRequestSchema) {}` — import the class as a value, never `import type`. */
export function zodDto<S extends z.ZodType>(schema: S): ZodDtoClass<S> {
  class ZodDto {
    static readonly schema = schema;
    static readonly isZodDto = true as const;
  }
  return ZodDto as unknown as ZodDtoClass<S>;
}

function isZodDto(value: unknown): value is ZodDtoClass {
  return typeof value === 'function' && (value as Partial<ZodDtoClass>).isZodDto === true;
}

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === 'custom') return value;
    if (!isZodDto(metadata.metatype)) {
      throw new Error(`Route ${metadata.type} parameter has no zod DTO schema (use zodDto()).`);
    }
    const result = metadata.metatype.schema.safeParse(value);
    if (!result.success) {
      throw new DomainError('VALIDATION_FAILED', 'Validation failed', {
        fields: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
