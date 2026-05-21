import { Component } from '@angular/core';

interface QuickStat {
  label: string;
  value: string;
  icon: string;
  tone: 'sage' | 'pink' | 'yellow';
}

interface Transaction {
  label: string;
  category: string;
  date: string;
  amount: string;
  icon: string;
  tag: string;
  tone: 'sage' | 'pink' | 'yellow';
}

interface NavItem {
  label: string;
  icon: string;
  active?: boolean;
}

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss']
})
export class Tab1Page {
  readonly username = 'Mia';
  readonly currentMonth = 'May 2026';
  readonly monthlyBudget = '$2,400';
  readonly amountLeft = '$846';
  readonly budgetProgress = 65;

  readonly quickStats: QuickStat[] = [
    {
      label: 'Spent this month',
      value: '$1,554',
      icon: '🧾',
      tone: 'pink'
    },
    {
      label: 'Savings',
      value: '$620',
      icon: '🌱',
      tone: 'sage'
    },
    {
      label: 'Top category',
      value: 'Cafe',
      icon: '☕',
      tone: 'yellow'
    }
  ];

  readonly transactions: Transaction[] = [
    {
      label: 'little treat ☕',
      category: 'Cafe run',
      date: 'May 18',
      amount: '-$12.80',
      icon: '☕',
      tag: 'soft spend',
      tone: 'yellow'
    },
    {
      label: 'late night snack 🍜',
      category: 'Food mood',
      date: 'May 17',
      amount: '-$18.40',
      icon: '🍜',
      tag: 'worth it',
      tone: 'pink'
    },
    {
      label: 'impulse buy 🛍️',
      category: 'Cute find',
      date: 'May 16',
      amount: '-$38.00',
      icon: '🛍️',
      tag: 'check-in',
      tone: 'pink'
    },
    {
      label: 'future me fund 🌱',
      category: 'Savings',
      date: 'May 15',
      amount: '+$180.00',
      icon: '🌱',
      tag: 'glow up',
      tone: 'sage'
    }
  ];

  readonly navItems: NavItem[] = [
    { label: 'Home', icon: 'home', active: true },
    { label: 'Analytics', icon: 'bar-chart' },
    { label: 'Add Expense', icon: 'add-circle' },
    { label: 'Goals', icon: 'heart' },
    { label: 'Profile', icon: 'person' }
  ];
}
