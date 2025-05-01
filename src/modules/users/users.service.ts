import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { RedisService } from '../../common/db/redis.service';
import { User } from './entities/user.entity';
import { otpGenerator } from '../../common/utils/otp-generator';
import { TwilioService } from '../sms/sms.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UploadPhotoDto } from './dto/upload-photo.dto';
import { createClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UsersService {
  private supabase;
  private bucketName = 'user';
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>, // Fixed typo: userRpository -> userRepository
    private readonly redisService: RedisService,
    private readonly twilioService: TwilioService,
    private readonly configService: ConfigService,
  ) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase configuration');
    } else {
      this.supabase = createClient(supabaseUrl, supabaseKey);
    }
  }

  async sendOtp(phone_number: string): Promise<{ message: string }> {
    const otp = otpGenerator();
    if (!phone_number) throw new BadRequestException('Incorrect Phone Number.');

    console.log(otp);
    await this.redisService.setOTP(`otp:${phone_number}`, otp);

    try {
      // Send OTP via Twilio
      await this.twilioService.sendSMS(
        phone_number,
        `Your verification code is: ${otp}`,
      );

      return {
        message: 'OTP Code sent successfully',
      };
    } catch (error) {
      console.error('Error sending OTP via Twilio:', error);
      throw new BadRequestException('Failed to send OTP');
    }
  }

  async verifyOtp(phone: string, otp: string): Promise<{ success: boolean }> {
    const storedOtp = await this.redisService.getOTP(`otp:${phone}`);
    if (!storedOtp || storedOtp !== otp) {
      throw new BadRequestException('Invalid or expired OTP');
    }
    await this.redisService.deleteOTP(`otp:${phone}`);
    return { success: true };
  }

  // New method for creating user with base64 images
  async createWithBase64(createUserDto: CreateUserDto): Promise<User> {
    try {
      console.log('Creating user with base64 image data');

      const {
        fullname,
        address,
        city,
        dateOfBirth,
        emergencyContactName,
        emergencyPhone,
        height,
        jacketSize,
        pantsSize,
        postalCode,
        shortSize,
        weight,
        tShirtSize,
        activePlan,
        experienceLevel,
        gender,
        parent_name,
        phone_number,
        email,
        current_skill_level,
        player_positions,
        custom_position,
        photoUrl,
        NationalIdCard,
        policy,
      } = createUserDto;

      // Convert numeric values
      const numericHeight = Number(height) || 0;
      const numericWeight = Number(weight) || 0;

      // Validate base64 images if provided
      if (photoUrl && !this.isValidBase64Image(photoUrl)) {
        throw new BadRequestException(
          'Invalid profile photo format. Must be a valid base64 image',
        );
      }

      if (NationalIdCard && !this.isValidBase64Image(NationalIdCard)) {
        throw new BadRequestException(
          'Invalid National ID card format. Must be a valid base64 image',
        );
      }

      // Create user object including base64 images
      const newUser = {
        fullname,
        gender,
        parent_name,
        phone_number,
        email,
        address,
        city,
        dateOfBirth,
        emergencyContactName,
        emergencyPhone,
        height: numericHeight,
        jacketSize,
        pantsSize,
        postalCode,
        shortSize,
        weight: numericWeight,
        tShirtSize,
        activePlan,
        experienceLevel,
        current_skill_level,
        player_positions,
        custom_position,
        photoUrl: photoUrl || '',
        NationalIdCard: NationalIdCard || '',
        policy: policy || true,
      };

      // Save user with base64 images directly in the database
      const savedUser = await this.userRepository.save(newUser);
      console.log('User saved with ID:', savedUser.id);
      console.log('Profile photo saved:', savedUser.photoUrl ? 'Yes' : 'No');
      console.log(
        'National ID card saved:',
        savedUser.NationalIdCard ? 'Yes' : 'No',
      );

      return savedUser;
    } catch (error) {
      console.error('Error creating user with base64 photos:', error);
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to create user with photos',
      );
    }
  }

  // Helper method to validate base64 image strings
  private isValidBase64Image(base64String: string): boolean {
    // Check if the string starts with a data URI scheme
    if (!base64String.startsWith('data:image/')) {
      return false;
    }

    // Check if it has the base64 format
    if (!base64String.includes(';base64,')) {
      return false;
    }

    // Additional validation could be added here
    return true;
  }

  // Keeping the old method for backward compatibility
  private async uploadFileToSupabase(
    file: Express.Multer.File,
    prefix: string = '',
  ): Promise<string> {
    if (!this.supabase) {
      throw new InternalServerErrorException('Storage service not configured');
    }

    // بررسی نوع فایل
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG and PNG images are allowed');
    }

    // ایجاد نام منحصر به فرد برای فایل
    const uniqueFileName = `${prefix}${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;

    // آپلود فایل به Supabase
    const { error } = await this.supabase.storage
      .from(this.bucketName)
      .upload(uniqueFileName, file.buffer, {
        contentType: file.mimetype,
        upsert: true, // اجازه جایگزینی در صورت وجود فایل قبلی
      });

    if (error) {
      console.error('Error uploading to Supabase:', error);
      throw new InternalServerErrorException(
        'Failed to upload file to storage',
      );
    }

    // دریافت URL عمومی فایل
    const { data: urlData } = this.supabase.storage
      .from(this.bucketName)
      .getPublicUrl(uniqueFileName);

    if (!urlData || !urlData.publicUrl) {
      throw new InternalServerErrorException('Failed to get public URL');
    }

    return urlData.publicUrl;
  }

  private async uploadBase64ToSupabase(base64String: string, path: string) {
    const base64Data = base64String.split(',')[1]; // جدا کردن بخش Base64 از header

    const { error } = await this.supabase.storage
      .from('your-bucket-name') // نام باکت
      .upload(path, Buffer.from(base64Data, 'base64'), {
        contentType: 'image/jpeg', // یا نوع فایل مورد نظر شما
        upsert: true, // اگر فایل قبلاً وجود داشت، آن را بروزرسانی می‌کند
      });

    if (error) {
      throw new Error('Failed to upload image to Supabase Storage');
    }

    // دریافت URL فایل پس از آپلود
    const { publicURL, error: urlError } = this.supabase.storage
      .from('your-bucket-name')
      .getPublicUrl(path);

    if (urlError) {
      throw new Error('Failed to generate public URL');
    }

    return publicURL;
  }

  // Keeping the old method for backward compatibility
  async create(
    createUserDto: CreateUserDto,
    files?: {
      profilePhoto?: Express.Multer.File;
      nationalIdPhoto?: Express.Multer.File;
    },
  ): Promise<User> {
    try {
      console.log(
        'Processing user creation with files:',
        files ? Object.keys(files) : 'no files',
      );

      const {
        fullname,
        address,
        city,
        dateOfBirth,
        emergencyContactName,
        emergencyPhone,
        height,
        jacketSize,
        pantsSize,
        postalCode,
        shortSize,
        weight,
        tShirtSize,
        activePlan,
        experienceLevel,
        gender,
        parent_name,
        phone_number,
        email,
        current_skill_level,
        player_positions,
        custom_position,
      } = createUserDto;

      // Convert numeric values
      const numericHeight = Number(height) || 0;
      const numericWeight = Number(weight) || 0;

      // Create new user object
      const newUser = {
        fullname,
        gender,
        parent_name,
        phone_number,
        email,
        address,
        city,
        dateOfBirth,
        emergencyContactName,
        emergencyPhone,
        height: numericHeight,
        jacketSize,
        pantsSize,
        postalCode,
        shortSize,
        weight: numericWeight,
        tShirtSize,
        activePlan,
        experienceLevel,
        current_skill_level,
        player_positions,
        custom_position,
        photoUrl: '', // Will be updated if file exists
        NationalIdCard: '', // Will be updated if file exists
        policy: true,
      };

      // First save user to get an ID
      let savedUser = await this.userRepository.save(newUser);
      console.log('User saved with ID:', savedUser.id);

      // Process files if they exist
      if (files) {
        // Handle profile photo
        if (files.profilePhoto) {
          try {
            console.log('Uploading profile photo...');
            const photoUrl = await this.uploadFileToSupabase(
              files.profilePhoto,
              `profile_${savedUser.id}_`,
            );
            savedUser.photoUrl = photoUrl;
            console.log('Profile photo uploaded:', photoUrl);
          } catch (error) {
            console.error('Error uploading profile photo:', error);
            // Continue even if photo upload fails
          }
        }

        // Handle national ID photo
        if (files.nationalIdPhoto) {
          try {
            console.log('Uploading national ID card...');
            const nationalIdUrl = await this.uploadFileToSupabase(
              files.nationalIdPhoto,
              `national_id_${savedUser.id}_`,
            );
            savedUser.NationalIdCard = nationalIdUrl;
            console.log('National ID card uploaded:', nationalIdUrl);
          } catch (error) {
            console.error('Error uploading national ID card:', error);
            // Continue even if photo upload fails
          }
        }

        // Save user again with updated photo URLs
        if (files.profilePhoto || files.nationalIdPhoto) {
          savedUser = await this.userRepository.save(savedUser);
          console.log('User updated with photo URLs');
        }
      }

      return savedUser;
    } catch (error) {
      console.error('Error creating user with photos:', error);
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to create user with photos',
      );
    }
  }

  async uploadPhoto(
    createUploadPhotoDto: UploadPhotoDto,
    file: Express.Multer.File,
  ): Promise<User> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    try {
      if (!this.supabase) {
        throw new InternalServerErrorException(
          'Storage service not configured',
        );
      }

      // ابتدا کاربر را بر اساس userId در UploadPhotoDto پیدا می‌کنیم
      const user = await this.userRepository.findOne({
        where: { id: createUploadPhotoDto.userId },
      });

      if (!user) {
        throw new BadRequestException(
          `User with ID ${createUploadPhotoDto.userId} not found`,
        );
      }

      // بررسی نوع فایل
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg'];
      if (!allowedMimeTypes.includes(file.mimetype)) {
        throw new BadRequestException('Only JPEG and PNG images are allowed');
      }

      // ایجاد نام منحصر به فرد برای فایل
      const uniqueFileName = `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;

      // آپلود فایل به Supabase
      const { error } = await this.supabase.storage
        .from(this.bucketName)
        .upload(uniqueFileName, file.buffer, {
          contentType: file.mimetype,
          upsert: true, // اجازه جایگزینی در صورت وجود فایل قبلی
        });

      if (error) {
        console.error('Error uploading to Supabase:', error);
        throw new InternalServerErrorException(
          'Failed to upload file to storage',
        );
      }

      // دریافت URL عمومی فایل
      const { data: urlData } = this.supabase.storage
        .from(this.bucketName)
        .getPublicUrl(uniqueFileName);

      if (!urlData || !urlData.publicUrl) {
        throw new InternalServerErrorException('Failed to get public URL');
      }

      const publicUrl = urlData.publicUrl;

      // بروزرسانی فیلد photoUrl کاربر موجود
      user.photoUrl = publicUrl;

      // ذخیره تغییرات کاربر
      return await this.userRepository.save(user);
    } catch (error) {
      // مدیریت خطاها به صورت مناسب
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      console.error('Error uploading photo:', error);
      throw new InternalServerErrorException('Failed to upload image');
    }
  }

  async uploadNationalIdCard(
    uploadPhotoDto: UploadPhotoDto,
    file: Express.Multer.File,
  ): Promise<User> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    try {
      if (!this.supabase) {
        throw new InternalServerErrorException(
          'Storage service not configured',
        );
      }

      // ابتدا کاربر را بر اساس userId در UploadPhotoDto پیدا می‌کنیم
      const user = await this.userRepository.findOne({
        where: { id: uploadPhotoDto.userId },
      });

      if (!user) {
        throw new BadRequestException(
          `User with ID ${uploadPhotoDto.userId} not found`,
        );
      }

      // بررسی نوع فایل
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg'];
      if (!allowedMimeTypes.includes(file.mimetype)) {
        throw new BadRequestException('Only JPEG and PNG images are allowed');
      }

      // ایجاد نام منحصر به فرد برای فایل
      const uniqueFileName = `national_id_${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;

      // آپلود فایل به Supabase
      const { error } = await this.supabase.storage
        .from(this.bucketName)
        .upload(uniqueFileName, file.buffer, {
          contentType: file.mimetype,
          upsert: true, // اجازه جایگزینی در صورت وجود فایل قبلی
        });

      if (error) {
        console.error('Error uploading to Supabase:', error);
        throw new InternalServerErrorException(
          'Failed to upload file to storage',
        );
      }

      // دریافت URL عمومی فایل
      const { data: urlData } = this.supabase.storage
        .from(this.bucketName)
        .getPublicUrl(uniqueFileName);

      if (!urlData || !urlData.publicUrl) {
        throw new InternalServerErrorException('Failed to get public URL');
      }

      const publicUrl = urlData.publicUrl;

      // بروزرسانی فیلد NationalIdCard کاربر موجود
      user.NationalIdCard = publicUrl;

      // ذخیره تغییرات کاربر
      return await this.userRepository.save(user);
    } catch (error) {
      // مدیریت خطاها به صورت مناسب
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      console.error('Error uploading national ID card:', error);
      throw new InternalServerErrorException(
        'Failed to upload national ID card image',
      );
    }
  }

  // Method to upload base64 image for an existing user
  async uploadBase64Photo(userId: number, base64Image: string): Promise<User> {
    try {
      if (!this.isValidBase64Image(base64Image)) {
        throw new BadRequestException('Invalid base64 image format');
      }

      const user = await this.userRepository.findOne({
        where: { id: userId },
      });

      if (!user) {
        throw new BadRequestException(`User with ID ${userId} not found`);
      }

      // Update the user's photoUrl with base64 image
      user.photoUrl = base64Image;

      // Save the updated user
      return await this.userRepository.save(user);
    } catch (error) {
      console.error('Error uploading base64 photo:', error);
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to upload base64 image');
    }
  }

  // Method to upload base64 National ID card for an existing user
  async uploadBase64NationalId(
    userId: number,
    base64Image: string,
  ): Promise<User> {
    try {
      if (!this.isValidBase64Image(base64Image)) {
        throw new BadRequestException('Invalid base64 image format');
      }

      const user = await this.userRepository.findOne({
        where: { id: userId },
      });

      if (!user) {
        throw new BadRequestException(`User with ID ${userId} not found`);
      }

      // Update the user's NationalIdCard with base64 image
      user.NationalIdCard = base64Image;

      // Save the updated user
      return await this.userRepository.save(user);
    } catch (error) {
      console.error('Error uploading base64 national ID:', error);
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to upload base64 image');
    }
  }

  async findAll() {
    return await this.userRepository.find();
  }

  async findOne(id: number) {
    return await this.userRepository.findOne({ where: { id } });
  }

  async findByPhoneNumber(phoneNumber: string) {
    console.log(phoneNumber);
    const user = await this.userRepository.findOne({
      where: { phone_number: phoneNumber },
    });

    if (!user) {
      return false;
    }

    return user;
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Update user properties with the values from updateUserDto
    Object.assign(user, updateUserDto);

    // Save the updated user
    await this.userRepository.save(user);

    return user;
  }

  async updateByPhone(phone_number: string, updateUserDto: UpdateUserDto) {
    const user = await this.userRepository.findOne({ where: { phone_number } });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Update user properties with the values from updateUserDto
    Object.assign(user, updateUserDto);

    // Save the updated user
    await this.userRepository.save(user);

    return user;
  }

  async remove(id: number) {
    await this.userRepository.delete(id);
    return `This action removes a #${id} user`;
  }
}
