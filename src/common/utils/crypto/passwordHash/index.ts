import * as bcrypt from 'bcryptjs';

/**
 * هش کردن رمز عبور
 * @param password رمز عبور ورودی
 * @returns رمز عبور هش شده
 */
export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);
  return hashedPassword;
};

/**
 * بررسی رمز عبور
 * @param password رمز عبور ورودی
 * @param hashedPassword رمز عبور هش شده
 * @returns نتیجه بررسی
 */
export const comparePassword = async (
  password: string,
  hashedPassword: string,
): Promise<boolean> => {
  return await bcrypt.compare(password, hashedPassword);
};
