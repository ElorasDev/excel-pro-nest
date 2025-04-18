import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('send-otp')
  @ApiOperation({ summary: 'Send OTP code to phone number' })
  @ApiResponse({ status: 200, description: 'OTP Code sent successfully' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { phone_number: { type: 'string' } },
    },
  })
  sendOtp(@Body('phone_number') phone_number: string) {
    return this.usersService.sendOtp(phone_number);
  }

  @Post('verify-otp')
  @ApiOperation({ summary: 'Verify OTP code' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        phone_number: { type: 'string' },
        otp: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'OTP verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  async verifyOtp(
    @Body('phone_number') phone_number: string,
    @Body('otp') otp: string,
  ) {
    return this.usersService.verifyOtp(phone_number, otp);
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new user after OTP verification' })
  @ApiResponse({ status: 201, description: 'User successfully created.' })
  @ApiResponse({ status: 400, description: 'Invalid input data or OTP error.' })
  register(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOperation({ summary: 'Get all users' })
  @ApiResponse({ status: 200, description: 'List of users.' })
  findAllUser() {
    return this.usersService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiResponse({ status: 200, description: 'User data.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  findOneUser(@Param('id') id: string) {
    return this.usersService.findOne(+id);
  }

  @Get('phone/:phoneNumber')
  @ApiOperation({ summary: 'Get a user by phone number' })
  @ApiResponse({ status: 200, description: 'User data.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  findUserByPhone(@Param('phoneNumber') phoneNumber: string) {
    return this.usersService.findByPhoneNumber(phoneNumber);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a user by ID' })
  @ApiResponse({ status: 200, description: 'User successfully updated.' })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data or user not found.',
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  updateUser(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(+id, updateUserDto);
  }

  @Put('phone/:phoneNumber')
  @ApiOperation({ summary: 'Update a user by ID' })
  @ApiResponse({ status: 200, description: 'User successfully updated.' })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data or user not found.',
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  updateUserByPhone(
    @Param('phoneNumber') phoneNumber: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.updateByPhone(phoneNumber, updateUserDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a user by ID' })
  @ApiResponse({ status: 200, description: 'User successfully deleted.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  removeUser(@Param('id') id: string) {
    return this.usersService.remove(+id);
  }
}
