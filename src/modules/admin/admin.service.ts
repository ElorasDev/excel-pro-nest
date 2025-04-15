import { Injectable, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Admin } from '../auth/entities/admin.entity';
import { CreateAuthDto } from '../auth/dto/create-auth.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { UpdateAuthDto } from '../auth/dto/update-auth.dto';
import { hashPassword } from 'src/common/utils/crypto/passwordHash';

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

  async update(id: number, updateAdminDto: UpdateAuthDto) {
    const admin = await this.findOne(id); // will throw if not found

    if (updateAdminDto.password) {
      updateAdminDto.password = await hashPassword(updateAdminDto.password);
    }

    Object.assign(admin, updateAdminDto);
    return this.adminRepository.save(admin);
  }

  async remove(id: number) {
    const admin = await this.findOne(id); // will throw if not found
    await this.adminRepository.remove(admin);
    return { message: `Admin with id ${id} has been removed.` };
  }
}
