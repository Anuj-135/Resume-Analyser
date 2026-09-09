/**
 * Converts the first page of a PDF File into a PNG image File.
 *
 * @param {File} file - The PDF file to convert.
 * @returns {Promise<{ file: File | null, error: string | null }>}
 */
export async function convertPdfToImage(file) {
    try {
        // Dynamically import pdfjs-dist (client-side only)
        const pdfjsLib = await import('pdfjs-dist');

        // Point the worker to the bundled worker file served from public/
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        // Read the PDF file as an ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();

        // Load the PDF document
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        // Render the first page
        const page = await pdf.getPage(1);

        const scale = 2; // Higher scale = better quality
        const viewport = page.getViewport({ scale });

        // Create an offscreen canvas
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext('2d');

        await page.render({ canvasContext: context, viewport }).promise;

        // Convert canvas to a Blob, then wrap it in a File
        const imageFile = await new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Canvas toBlob returned null'));
                    return;
                }
                const outputFile = new File(
                    [blob],
                    file.name.replace(/\.pdf$/i, '.png'),
                    { type: 'image/png' }
                );
                resolve(outputFile);
            }, 'image/png');
        });

        return { file: imageFile, error: null };
    } catch (err) {
        console.error('convertPdfToImage error:', err);
        return { file: null, error: err.message ?? 'Unknown error' };
    }
}
