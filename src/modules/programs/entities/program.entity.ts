import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToMany,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('program')
export class Program {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  index_image_url: string;

  @Column({ type: 'text' })
  program_name: string;

  @Column('float')
  price: number;

  @Column({ type: 'text' })
  description: string;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @ManyToMany(() => User, (user) => user.programs)
  users: User[];
}
