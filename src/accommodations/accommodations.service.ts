import { Injectable } from '@nestjs/common';

interface StyleFilterInput {
  destination?: string;
  budgetTier?: string;
  style?: string;
}

@Injectable()
export class AccommodationsService {
  getStyleOptions(input: StyleFilterInput) {
    const destination = (input.destination ?? '').trim();
    const budgetTier = (input.budgetTier ?? '').trim().toLowerCase();
    const preferredStyle = (input.style ?? '').trim().toLowerCase();

    const allOptions = [
      { code: 'design_hotel', label: 'Design Hotel', tier: 'premium' },
      { code: 'jungle_lodge', label: 'Jungle Lodge', tier: 'comfortable' },
      { code: 'heritage_riad', label: 'Heritage Riad', tier: 'comfortable' },
      { code: 'beach_bungalow', label: 'Beach Bungalow', tier: 'thoughtful' },
      { code: 'city_boutique', label: 'City Boutique', tier: 'comfortable' },
      {
        code: 'village_homestay',
        label: 'Village Homestay',
        tier: 'shoestring',
      },
    ];

    const budgetFiltered =
      budgetTier.length === 0
        ? allOptions
        : allOptions.filter((option) => {
            if (budgetTier === 'no_limit' || budgetTier === 'premium') {
              return option.tier !== 'shoestring';
            }

            if (budgetTier === 'comfortable') {
              return option.tier !== 'premium';
            }

            if (budgetTier === 'thoughtful') {
              return option.tier !== 'premium' && option.tier !== 'comfortable';
            }

            return true;
          });

    const styleFiltered =
      preferredStyle.length === 0
        ? budgetFiltered
        : budgetFiltered.filter(
            (option) =>
              option.code.includes(preferredStyle) ||
              option.label.toLowerCase().includes(preferredStyle),
          );

    return {
      destinationHint: destination || null,
      budgetTier: budgetTier || null,
      options: styleFiltered.length > 0 ? styleFiltered : budgetFiltered,
    };
  }
}
