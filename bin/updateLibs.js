import fs from 'fs/promises';
import path from 'path';

const LIB_DIR = path.resolve('./web/lib');

const FILES_TO_COPY = [
  {
    src: './node_modules/bootstrap/dist/css/bootstrap.min.css',
    dest: 'bootstrap.min.css',
  },
  {
    src: './node_modules/bootstrap/dist/css/bootstrap.min.css.map',
    dest: 'bootstrap.min.css.map',
  },
  {
    src: './node_modules/bootstrap/dist/js/bootstrap.bundle.min.js',
    dest: 'bootstrap.bundle.min.js',
  },
  {
    src: './node_modules/webmidi/dist/iife/webmidi.iife.min.js',
    dest: 'webmidi.iife.min.js',
  },
];

async function updateLibs() {
  try {
    console.log('Updating libs...');

    // Clear and recreate lib directory
    await fs.rm(LIB_DIR, { recursive: true, force: true });
    await fs.mkdir(LIB_DIR, { recursive: true });

    // Copy files
    for (const file of FILES_TO_COPY) {
      const srcPath = path.resolve(file.src);
      const destPath = path.join(LIB_DIR, file.dest);

      console.log(`Copying ${file.src} to ${destPath}`);
      await fs.copyFile(srcPath, destPath);
    }

    console.log('Libs updated successfully.');
  } catch (error) {
    console.error('Error updating libs:', error);
    process.exit(1);
  }
}

updateLibs();
