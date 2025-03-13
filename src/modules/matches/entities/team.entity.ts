import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Match } from './match.entity';
import { User } from 'src/modules/users/entities/user.entity';

@Entity({ name: 'teams' })
export class Team {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', name: 'name' })
  name: string;

  @Column({ type: 'text', nullable: true })
  logo?: string;

  @OneToMany(() => User, (user) => user.id)
  user: User[];

  @OneToMany(() => Match, (match) => match.home_team)
  home_matches: Match[];

  @OneToMany(() => Match, (match) => match.away_team)
  away_matches: Match[];
}
