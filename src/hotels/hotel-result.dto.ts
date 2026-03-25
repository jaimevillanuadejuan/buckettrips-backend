export class HotelResult {
  name: string;
  stars: number | null;
  overallRating: number | null;
  reviews: number | null;
  pricePerNight: number | null;
  currency: string;
  thumbnailUrl: string | null;
  deepLinkUrl: string | null;
  amenities: string[];
}
