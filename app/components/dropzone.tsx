import { useCallback, useEffect, useRef, useState } from "react";

interface DropzoneProps {
	onFiles: (files: File[]) => void;
	/** Collapses to a slim bar once there's a list below it. */
	compact: boolean;
}

/**
 * Whole-window drag target. Listening on window rather than the element means a file dropped
 * anywhere counts — chasing a small rectangle with a dragged file is a bad time.
 */
export function Dropzone({ onFiles, compact }: DropzoneProps) {
	const [dragging, setDragging] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	// dragenter/dragleave fire for every child element, so track depth instead of a boolean.
	const depth = useRef(0);

	const emit = useCallback(
		(list: FileList | null) => {
			const files = Array.from(list ?? []);
			if (files.length) onFiles(files);
		},
		[onFiles],
	);

	useEffect(() => {
		const onDragEnter = (event: DragEvent) => {
			if (!event.dataTransfer?.types.includes("Files")) return;
			event.preventDefault();
			depth.current++;
			setDragging(true);
		};
		const onDragOver = (event: DragEvent) => {
			if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
		};
		const onDragLeave = () => {
			depth.current = Math.max(0, depth.current - 1);
			if (depth.current === 0) setDragging(false);
		};
		const onDrop = (event: DragEvent) => {
			if (!event.dataTransfer?.types.includes("Files")) return;
			event.preventDefault();
			depth.current = 0;
			setDragging(false);
			emit(event.dataTransfer.files);
		};
		const onPaste = (event: ClipboardEvent) => {
			const files = Array.from(event.clipboardData?.files ?? []);
			if (files.length) {
				event.preventDefault();
				onFiles(files);
			}
		};

		window.addEventListener("dragenter", onDragEnter);
		window.addEventListener("dragover", onDragOver);
		window.addEventListener("dragleave", onDragLeave);
		window.addEventListener("drop", onDrop);
		window.addEventListener("paste", onPaste);
		return () => {
			window.removeEventListener("dragenter", onDragEnter);
			window.removeEventListener("dragover", onDragOver);
			window.removeEventListener("dragleave", onDragLeave);
			window.removeEventListener("drop", onDrop);
			window.removeEventListener("paste", onPaste);
		};
	}, [emit, onFiles]);

	return (
		<>
			<button
				type="button"
				onClick={() => inputRef.current?.click()}
				aria-label="Choose files to upload"
				className={`group relative flex w-full items-center justify-center overflow-hidden rounded-3xl border border-dashed transition-all duration-300 ${
					compact ? "min-h-32 px-8 py-8" : "min-h-[58dvh] px-8 py-20"
				} ${
					dragging
						? "border-violet-400 bg-violet-50/80 shadow-[0_0_60px_-15px] shadow-violet-400/60"
						: "border-violet-200 bg-white/50 shadow-soft backdrop-blur-sm hover:border-violet-300 hover:bg-white/70 hover:shadow-lift"
				}`}
			>
				<div
					className={`pointer-events-none flex flex-col items-center text-center transition-transform duration-300 ${
						dragging ? "scale-105" : ""
					}`}
				>
					<TossGlyph active={dragging} compact={compact} />
					<p
						className={`font-display tracking-tight transition-colors ${
							compact ? "mt-3 text-xl" : "mt-6 text-3xl sm:text-4xl"
						} ${dragging ? "text-accent-strong italic" : "text-ink"}`}
					>
						{dragging ? "Let go" : "Toss a file here"}
					</p>
					{!compact && (
						<p className="mt-2 text-muted text-sm">
							or click to browse — paste works too. Up to 5&nbsp;GB.
						</p>
					)}
				</div>
			</button>

			<input
				ref={inputRef}
				type="file"
				multiple
				className="sr-only"
				onChange={(event) => {
					emit(event.target.files);
					event.target.value = "";
				}}
			/>
		</>
	);
}

/** An arc with a falling dot — the toss. Nudges up and over when a file is over the window. */
function TossGlyph({ active, compact }: { active: boolean; compact: boolean }) {
	const size = compact ? 36 : 56;
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 48 48"
			fill="none"
			aria-hidden="true"
			className={`transition-colors duration-300 ${active ? "text-violet-500" : "text-violet-300 group-hover:text-violet-400"}`}
		>
			<title>Toss</title>
			<path
				d="M6 36C10 16 24 8 42 12"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeDasharray="3 4"
			/>
			<circle
				cx="42"
				cy="12"
				r="4"
				fill="var(--color-rose-400)"
				className={`transition-transform duration-500 ${active ? "translate-y-[22px] translate-x-[-34px]" : ""}`}
				style={{ transformOrigin: "42px 12px" }}
			/>
		</svg>
	);
}
