import { join } from 'path';
import { exists } from './fs-exists';
import { transpileTs } from './transpile';

export const postProcessing = async (path: string, inputs: Record<string, unknown>): Promise<void> => {
  const postProcessingPath = join(path, 'post-processing.ts');
  const hasPostProcessing = await exists(postProcessingPath);
  if (hasPostProcessing) {
    const jsPath = await transpileTs(postProcessingPath);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const postProcessing = require(jsPath);
    await postProcessing.default(inputs);
  }
};
