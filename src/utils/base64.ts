export function encodeBase64(input: string): string {
	if (!input) return "";
	if (typeof btoa === "function" && typeof TextEncoder !== "undefined") {
		const bytes = new TextEncoder().encode(input);
		let binary = "";
		for (let i = 0; i < bytes.length; i++) {
			binary += String.fromCharCode(bytes[i] ?? 0);
		}
		return btoa(binary);
	}
	if (typeof Buffer !== "undefined") {
		return Buffer.from(input, "utf-8").toString("base64");
	}
	throw new Error("Base64 encode not supported in this environment.");
}

export function decodeBase64(input: string): string {
	if (!input) return "";
	if (typeof atob === "function" && typeof TextDecoder !== "undefined") {
		const binary = atob(input);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return new TextDecoder().decode(bytes);
	}
	if (typeof Buffer !== "undefined") {
		return Buffer.from(input, "base64").toString("utf-8");
	}
	throw new Error("Base64 decode not supported in this environment.");
}
