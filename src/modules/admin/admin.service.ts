import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { Admin } from '../auth/entities/admin.entity';
import { CreateAuthDto } from '../auth/dto/create-auth.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { UpdateAuthDto } from '../auth/dto/update-auth.dto';
import {
  comparePassword,
  hashPassword,
} from 'src/common/utils/crypto/passwordHash';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Admin)
    private readonly adminRepository: Repository<Admin>,
  ) {}

  async create(createAdminDto: CreateAuthDto) {
    const { username, password, email, first_name, last_name } = createAdminDto;

    const hashedPassword = await hashPassword(password);

    const newAdmin = this.adminRepository.create({
      username,
      password: hashedPassword,
      email,
      first_name,
      last_name,
    });

    return this.adminRepository.save(newAdmin);
  }

  async findAll() {
    return await this.adminRepository.find({
      select: ['id', 'username', 'email', 'first_name', 'last_name'],
    });
  }

  async findOne(id: number) {
    const admin = await this.adminRepository.findOneBy({ id });
    if (!admin) {
      throw new NotFoundException(`Admin with id ${id} not found`);
    }
    return admin;
  }

  async update(id: number, updateAuthDto: UpdateAuthDto) {
    const admin = await this.findOne(id);

    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    // Check if trying to update sensitive fields (username, email, password)
    const isSensitiveUpdate =
      updateAuthDto.username !== undefined ||
      updateAuthDto.email !== undefined ||
      updateAuthDto.password !== undefined;

    // If updating sensitive fields, verify current password
    if (isSensitiveUpdate) {
      // Check if currentPassword field exists in the DTO
      if (!updateAuthDto.currentPassword) {
        throw new BadRequestException(
          'Current password is required to update username, email, or password',
        );
      }

      // Verify that the current password matches
      const isPasswordValid = await comparePassword(
        updateAuthDto.currentPassword,
        admin.password,
      );
      if (!isPasswordValid) {
        throw new UnauthorizedException('Current password is incorrect');
      }
    }

    // If password is being updated, hash it
    if (updateAuthDto.password) {
      updateAuthDto.password = await hashPassword(updateAuthDto.password);
    }

    // Remove currentPassword from DTO before saving
    delete updateAuthDto.currentPassword;

    // Filter out any fields that shouldn't be updated
    const allowedFields = [
      'username',
      'password',
      'first_name',
      'last_name',
      'email',
    ];
    const filteredUpdateDto = Object.keys(updateAuthDto)
      .filter((key) => allowedFields.includes(key))
      .reduce((obj, key) => {
        obj[key] = updateAuthDto[key];
        return obj;
      }, {});

    // Update admin properties with only allowed fields
    Object.assign(admin, filteredUpdateDto);
    return this.adminRepository.save(admin);
  }

  async remove(id: number) {
    const admin = await this.findOne(id); // will throw if not found
    await this.adminRepository.remove(admin);
    return { message: `Admin with id ${id} has been removed.` };
  }
}
