import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Match } from './match.entity';

@Entity({ name: 'referees' })
export class Referee {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', name: 'name' })
  name: string;

  @Column({ type: 'text', nullable: true })
  nationality?: string;

  @OneToMany(() => Match, (match) => match.referee)
  matches: Match[];
}
