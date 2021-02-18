/* eslint-disable no-param-reassign */
import {figmaRGBToHex} from '@figma-plugin/helpers';
import Dot from 'dot-object';
import {isSingleToken, slugify} from '../app/components/utils';
import {
    convertFigmaToLetterSpacing,
    convertFigmaToLineHeight,
    convertLetterSpacingToFigma,
    convertLineHeightToFigma,
    convertToFigmaColor,
} from './helpers';
import {notifyStyleValues} from './notifiers';

const dot = new Dot('/');

interface TypographyToken {
    value: {
        familyName: string;
        fontWeight: string;
        fontSize: number;
        lineHeight: string | number;
    };
    description?: string;
}

interface ColorToken {
    value: string;
    description?: string;
}

const updateColorStyles = (colorTokens, shouldCreate = false) => {
    const cols = dot.dot(colorTokens);
    console.log('cols are', colorTokens);
    const paints = figma.getLocalPaintStyles();
    Object.entries(cols).map(([key, token]: [string, ColorToken]) => {
        const splitKey = key.split('/');
        // not working for color styles with description and value
        if (splitKey[splitKey.length - 1] === 'value') splitKey.pop();
        const styleKey = splitKey.join('/');

        const value = isSingleToken(token) ? token.value : token;
        let matchingStyle = [];
        if (paints.length > 0) {
            matchingStyle = paints.filter((n) => n.name === styleKey);
        }
        if (typeof value === 'string') {
            const {color, opacity} = convertToFigmaColor(value);
            if (matchingStyle.length) {
                matchingStyle[0].paints = [{color, opacity, type: 'SOLID'}];
            } else if (shouldCreate) {
                const newStyle = figma.createPaintStyle();
                newStyle.paints = [{color, opacity, type: 'SOLID'}];
                newStyle.name = styleKey;
                if (token.description) {
                    newStyle.description = token.description;
                }
            }
        }
    });
    console.log('done with colors', cols);
};

export const setTextValuesOnTarget = async (target, values) => {
    const {fontFamily, fontWeight, fontSize, lineHeight, letterSpacing, paragraphSpacing, description} = values;
    const family = fontFamily || target.fontName.family;
    const style = fontWeight || target.fontName.style;
    await figma.loadFontAsync({family, style});

    if (fontFamily && fontWeight) {
        target.fontName = {
            family,
            style,
        };
    }

    if (fontSize) {
        target.fontSize = Number(fontSize);
    }
    if (lineHeight) {
        target.lineHeight = convertLineHeightToFigma(lineHeight);
    }
    if (letterSpacing) {
        target.letterSpacing = convertLetterSpacingToFigma(letterSpacing);
    }
    if (paragraphSpacing) {
        target.paragraphSpacing = Number(paragraphSpacing);
    }
    if (description) {
        target.description = description;
    }
};

const updateTextStyles = (textTokens, shouldCreate = false) => {
    const cols = dot.dot(textTokens);
    // Iterate over textTokens to create objects that match figma styles
    // e.g. H1/Bold ...
    const tokenObj = Object.entries(cols).reduce((acc, [key, token]) => {
        // Split token object by `/`
        let parrentKey: string | string[] = key.split('/');
        const value = isSingleToken(token) ? token.value : token;

        // Store current key for future reference, e.g. fontFamily, lineHeight and remove it from key
        const curKey = parrentKey.pop();
        if (parrentKey[parrentKey.length - 1] === 'value') parrentKey.pop();

        // Merge object again, now that we have the parent reference
        parrentKey = parrentKey.join('/');

        acc[parrentKey] = acc[parrentKey] || {};
        Object.assign(acc[parrentKey], {[curKey]: value});
        return acc;
    }, {});

    const textStyles = figma.getLocalTextStyles();

    console.log('tokenObj is', tokenObj);

    Object.entries(tokenObj).map(([key, value]: [string, TypographyToken]) => {
        const matchingStyle = textStyles.filter((n) => n.name === key);

        if (matchingStyle.length) {
            setTextValuesOnTarget(matchingStyle[0], value);
        } else if (shouldCreate) {
            const style = figma.createTextStyle();
            style.name = key;
            setTextValuesOnTarget(style, value);
        }
    });

    console.log('done with type', tokenObj);
};

export function updateStyles(tokens, shouldCreate = false): void {
    if (!tokens.colors && !tokens.typography) return;
    console.log('tokens are', tokens);
    if (tokens.colors) {
        updateColorStyles(tokens.colors, shouldCreate);
    }
    if (tokens.typography) {
        updateTextStyles(tokens.typography, shouldCreate);
    }
    console.log('end of tokenupdate');
}

export function pullStyles(styleTypes): void {
    let colors;
    let typography;
    let fontFamilies;
    let lineHeights;
    let fontWeights;
    let fontSizes;
    let letterSpacing;
    let paragraphSpacing;
    if (styleTypes.colorStyles) {
        colors = figma
            .getLocalPaintStyles()
            .filter((style) => style.paints.length === 1 && style.paints[0].type === 'SOLID')
            .map((style) => {
                const paint = style.paints[0];
                if (paint.type === 'SOLID') {
                    const {r, g, b} = paint.color;
                    const a = paint.opacity;
                    const options = {description: 'foobydoo'};
                    console.log('options are', options);
                    return [style.name, {value: figmaRGBToHex({r, g, b, a}), options}];
                }
                return null;
            });
    }
    if (styleTypes.textStyles) {
        const rawFontSizes = [];
        const fontCombinations = [];
        const rawLineHeights = [];
        const rawParagraphSpacing = [];
        const rawLetterSpacing = [];

        const figmaTextStyles = figma.getLocalTextStyles();
        figmaTextStyles.map((style) => {
            if (!rawFontSizes.includes(style.fontSize)) rawFontSizes.push(style.fontSize);
            fontCombinations.push(style.fontName);
            rawLineHeights.push(style.lineHeight);
            if (!rawParagraphSpacing.includes(style.paragraphSpacing)) rawParagraphSpacing.push(style.paragraphSpacing);
            rawLetterSpacing.push(style.letterSpacing);
        });

        fontSizes = rawFontSizes.sort((a, b) => a - b).map((size, idx) => [idx, size]);
        const uniqueFontCombinations = fontCombinations.filter(
            (v, i, a) => a.findIndex((t) => t.family === v.family && t.style === v.style) === i
        );

        lineHeights = rawLineHeights
            .filter((v, i, a) => a.findIndex((t) => t.unit === v.unit && t.value === v.value) === i)
            .map((lh, idx) => [idx, convertFigmaToLineHeight(lh)]);

        fontFamilies = [...new Set(uniqueFontCombinations.map((font) => font.family))].map((fontFamily) => [
            `font-${slugify(fontFamily)}`,
            fontFamily,
        ]);

        fontWeights = uniqueFontCombinations.map((font, idx) => [`font-${slugify(font.family)}-${idx}`, font.style]);

        paragraphSpacing = rawParagraphSpacing.sort((a, b) => a - b).map((size, idx) => [idx, size]);

        letterSpacing = rawLetterSpacing
            .filter((v, i, a) => a.findIndex((t) => t.unit === v.unit && t.value === v.value) === i)
            .map((lh, idx) => [idx, convertFigmaToLetterSpacing(lh)]);

        typography = figmaTextStyles.map((style) => {
            const obj = {
                fontFamily: `$fontFamilies.${fontFamilies.find((el: string[]) => el[1] === style.fontName.family)[0]}`,
                fontWeight: `$fontWeights.${
                    fontWeights.find(
                        (el: string[]) =>
                            el[0].includes(slugify(style.fontName.family)) && el[1] === style.fontName.style
                    )[0]
                }`,
                lineHeight: `$lineHeights.${
                    lineHeights.find(
                        (el: [number, string | number]) => el[1] === convertFigmaToLineHeight(style.lineHeight)
                    )[0]
                }`,
                fontSize: `$fontSizes.${fontSizes.find((el: number[]) => el[1] === style.fontSize)[0]}`,
                letterSpacing: `$letterSpacing.${
                    letterSpacing.find(
                        (el: [number, string | number]) => el[1] === convertFigmaToLetterSpacing(style.letterSpacing)
                    )[0]
                }`,
                paragraphSpacing: `$paragraphSpacing.${
                    paragraphSpacing.find((el: number[]) => el[1] === style.paragraphSpacing)[0]
                }`,
            };
            const description = style.description ?? null;

            console.log('style descr', description, style);

            return [style.name, {value: obj, description}];
        });
    }
    notifyStyleValues({
        colors,
        fontFamilies,
        lineHeights,
        fontWeights,
        fontSizes,
        letterSpacing,
        paragraphSpacing,
        typography,
    });
}
