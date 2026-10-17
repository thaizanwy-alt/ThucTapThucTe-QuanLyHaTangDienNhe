import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthenticatedRequest, JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { LoginDto } from './login.dto';
import { ChangePasswordDto } from './password.dto';
import { PasswordChangeAllowed } from './password-change-allowed.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() body: LoginDto) {
    return this.auth.login(body.email, body.password);
  }

  @Get('me')
  @PasswordChangeAllowed()
  @UseGuards(JwtAuthGuard, RolesGuard)
  me(@Req() request: AuthenticatedRequest) {
    const { id, email, role, isActive, mustChangePassword, version } = request.user;
    return { id, email, role, isActive, mustChangePassword, version };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @PasswordChangeAllowed()
  @UseGuards(JwtAuthGuard, RolesGuard)
  async changePassword(@Req() request: AuthenticatedRequest, @Body() dto: ChangePasswordDto): Promise<void> {
    await this.auth.changePassword(request.user.id, request.authVersion, dto.expectedVersion, dto.currentPassword, dto.newPassword);
  }
}
