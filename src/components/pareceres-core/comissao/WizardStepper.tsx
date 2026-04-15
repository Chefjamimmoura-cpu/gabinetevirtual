'use client';
import React from 'react';
import { Check } from 'lucide-react';
import styles from './comissao-wizard.module.css';

interface WizardStepperProps {
  currentStep: 1 | 2 | 3;
  materiasCount: number;
  ataGerada: boolean;
}

export function WizardStepper({ currentStep, materiasCount, ataGerada }: WizardStepperProps) {
  const steps = [
    { num: 1, label: materiasCount > 0 ? `Matérias (${materiasCount})` : 'Selecionar Matérias' },
    { num: 2, label: 'Gerar ATA' },
    { num: 3, label: 'Gerar Pareceres' },
  ];

  return (
    <div className={styles.stepper}>
      {steps.map((step, i) => {
        const isDone = step.num < currentStep || (step.num === 2 && ataGerada && currentStep === 3);
        const isActive = step.num === currentStep;

        return (
          <React.Fragment key={step.num}>
            {i > 0 && (
              <div className={`${styles.stepLine} ${isDone ? styles.stepLineDone : isActive ? styles.stepLineActive : ''}`} />
            )}
            <div className={styles.stepItem}>
              <div className={`${styles.stepCircle} ${isDone ? styles.stepCircleDone : isActive ? styles.stepCircleActive : styles.stepCirclePending}`}>
                {isDone ? <Check size={18} strokeWidth={3} /> : step.num}
              </div>
              <span className={`${styles.stepLabel} ${isDone ? styles.stepLabelDone : isActive ? styles.stepLabelActive : ''}`}>
                {step.label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
