using AquaPure.Api.Infrastructure;
using Xunit;

namespace AquaPure.Api.Tests
{
    public class SettingsTests
    {
        [Fact]
        public void Image_links_use_the_project_url_by_default()
        {
            var s = new Settings { SupabaseUrl = "https://ref.supabase.co" };
            Assert.Equal("https://ref.supabase.co/storage/v1/object/public/product-images/products/can%201.webp", s.ImageUrl("products/can 1.webp"));
        }

        [Fact]
        public void Image_links_use_the_public_url_when_set_so_blocked_networks_still_see_images()
        {
            var s = new Settings { SupabaseUrl = "https://ref.supabase.co", SupabasePublicUrl = "https://aquapure.example/supabase" };
            Assert.Equal("https://aquapure.example/supabase/storage/v1/object/public/product-images/a.png", s.ImageUrl("a.png"));
        }

        [Fact]
        public void Site_images_and_full_urls_are_left_alone()
        {
            var s = new Settings { SupabaseUrl = "https://ref.supabase.co" };
            Assert.Equal("/images/can.webp", s.ImageUrl("/images/can.webp"));
            Assert.Equal("https://cdn.example/x.png", s.ImageUrl("https://cdn.example/x.png"));
            Assert.Null(s.ImageUrl(null));
        }
    }
}
