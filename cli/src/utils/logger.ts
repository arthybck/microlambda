import { blue, green, cyan, yellow, red } from 'chalk';

/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
type LoggerFunction = (...args: any[]) => void;

interface ILogger {
  silly: LoggerFunction;
  debug: LoggerFunction;
  info: LoggerFunction;
  warn: LoggerFunction;
  error: LoggerFunction;
}

export const log: ILogger = {
  silly: (...args: any[]) => {
    if (process.env.MILA_DEBUG === '*') {
      console.debug(cyan('[SILLY]'), ...args);
    }
  },
  debug: (...args: any[]) => {
    if (process.env.MILA_DEBUG) {
      console.debug(blue('[DEBUG]'), ...args);
    }
  },
  info: (...args: any[]) => {
    console.info(green('[INFO]'), ...args);
  },
  warn: (...args: any[]) => {
    console.info(yellow('[WARNING]', ...args));
  },
  error: (...args: any[]) => {
    console.info(red('[ERROR]', ...args));
  },
};
