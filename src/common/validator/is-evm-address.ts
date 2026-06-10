import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';
import { isAddress } from 'viem';

export function IsEvmAddress(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isEvmAddress',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;

          return isAddress(value, {
            strict: false,
          });
        },

        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid EVM address`;
        },
      },
    });
  };
}
